define(["jquery",
        "base/js/namespace",
        './df-notebook/depview.js',
        './df-notebook/dfgraph.js',
        './df-notebook/toolbar.js',
        './df-notebook/codecell.js',
        './df-notebook/completer.js',
        './df-notebook/kernel.js',
        './df-notebook/notebook.js',
        './df-notebook/outputarea.js',
    ],
    function($, Jupyter, depview, dfgraph, df_toolbar) {

        Jupyter._dfkernel_loaded = false;

        var onload = function() {
            // reload the notebook after patching code
            var nb = Jupyter.notebook;
            var kernelspec = nb.metadata.kernelspec;
            console.log("NB PATH:", nb.notebook_path);
            console.log("KERNEL SPEC:", kernelspec);
            // FIXME do the kernelspec patch here instead of
            // in patch of load_notebook_success
            nb.contents.get(nb.notebook_path, {type: 'notebook'}).then(
                $.proxy(nb.reload_notebook, nb),
                $.proxy(nb.load_notebook_error, nb)
            );
            // load the toolbar
            df_toolbar.register(nb);

            // add event to be notified when cells need to be resent to kernel
            nb.events.on('kernel_ready.Kernel', function(event, data) {
                nb.invalidate_cells();
                // the kernel was already created, but $.proxy settings will
                // reference old handlers so relink _handle_input_message
                // needed to get execute_input messages
                var k = nb.kernel;
                k.register_iopub_handler('execute_input', $.proxy(k._handle_input_message, k));
                Jupyter._dfkernel_loaded = true;
            });

            // nb.events.on('preset_activated.CellToolbar', function(event, data) {
            //     if (data.name === 'Dataflow') {
            //         df_toolbar.update_overflows();
            //     }
            // });

            var depdiv = depview.create_dep_div();

            // hack to get widget auto-updates working...
            (function(_super) {
                Object.getPrototypeOf(Jupyter.notebook.kernel.widget_manager).create_view = function(model, options) {
                    var _super_result = _super.apply(this, arguments);
                    model.on('change:value', function() {
                        var m = this;
                        var view_ids = Object.keys(m.views);
                        view_ids.forEach(function (vid) {
                            m.views[vid].then(function(view) {
                                // console.log("CELL CHANGE:", cell, m.get('value'));
                                var cell = Jupyter.notebook.get_code_cell(view.options.output.execution_count);
                                // want to do downstream execution only
                                Jupyter.notebook.session.dfgraph.get_downstreams(cell.uuid).forEach(function(cid) {
                                    // console.log("DOWNSTREAM", cid);
                                    if (Jupyter.notebook.get_code_cell(cid).auto_update) {
                                        Jupyter.notebook.get_code_cell(cid).execute();
                                    }
                                });
                            });
                        });
                    }, model);
                    return _super_result;
                };
            }(Object.getPrototypeOf(Jupyter.notebook.kernel.widget_manager).create_view));


            Jupyter.toolbar.add_buttons_group([
                  {
                       'label'   : 'See Cell Dependencies',
                       'icon'    : 'fa-bar-chart',
                       'callback': function () {
                                                     depview.create_dep_view(depdiv,true,false);

                       }

               },{
                       'label'   : 'See Data Dependencies',
                       'icon'    : 'fa-bar-chart',
                       'callback': function () {
                                                     depview.create_dep_view(depdiv,false,false);

                       }

               },{
                       'label'   : 'See Semantic View',
                       'icon'    : 'fa-bar-chart',
                       'callback': function () {
                                                     depview.create_dep_view(depdiv,false,true);
                                                     depview.attach_controls(depdiv);

                       }

               }]);
        };
        return {onload:onload};
});

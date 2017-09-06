define([
    'jquery',
    'notebook/js/codecell',
    'base/js/namespace',
    'base/js/utils',
    'base/js/keyboard',
    'services/config',
    'notebook/js/cell',
    'notebook/js/outputarea',
    'notebook/js/completer',
    'notebook/js/celltoolbar',
    'codemirror/lib/codemirror',
    'codemirror/mode/python/python',
    'notebook/js/codemirror-ipython',
    '/kernelspecs/dfpython3/df-notebook/utils.js'
], function(
    $,
    codecell,
    IPython,
    utils,
    keyboard,
    configmod,
    cell,
    outputarea,
    completer,
    celltoolbar,
    CodeMirror,
    cmpython,
    cmip,
    dfutils
    ) {

    var CodeCell = codecell.CodeCell;
    var Cell = cell.Cell;
    var globalhistory = [];
    var old_range_val = 0;

    var create_scrollbar = function () {
        var link = document.createElement("link");
        link.type = "text/css";
        link.rel = "stylesheet";
        link.href = require.toUrl('/kernelspecs/dfpython3/df-notebook/slider.css','css');
        document.getElementsByTagName("head")[0].appendChild(link);

        $('#header').after("<div class='range'></div>");
        $('.range').slider({
            min:0,
            max:0,
            step: 1,
            value:0,
            change: function(event,ui){
                var curr_ele = ui.value - 1;
                $('.range p').text(globalhistory[curr_ele].date);
                if(curr_ele < old_range_val){
                    globalhistory.slice(curr_ele+1,old_range_val+1).reverse().forEach(function(a)
                    {
                        if(a.oldmd5 === null){
                            $('div#'+a.uuid).hide();
                        }
                        else{
                            var cell = Jupyter.notebook.get_code_cell(a.uuid);
                            cell.set_text(cell.cell_history[a.oldmd5].source);
                        }
                    })}
                else{
                    globalhistory.slice(old_range_val+1,curr_ele+1).forEach(function(a){
                        if(a.oldmd5 === null){
                            $('div#'+a.uuid).show();
                        }
                        else{
                            var cell = Jupyter.notebook.get_code_cell(a.uuid);
                            cell.set_text(cell.cell_history[a.newmd5].source);
                        }
                    })
                }
                old_range_val = curr_ele;
            }
        }).attr("id","range");

        $('#range').hide();
        $('.range').hide();
    };

	CodeCell.prototype.init_dfnb = function () {
	    if (!("uuid" in this)) {
	        this.uuid = this.notebook.get_new_id();
	        this.was_changed = true;

            this.cell_info_area = null;
            this.cell_upstream_deps = null;
            this.cell_downstream_deps = null;
            this.cell_history = {};
            this.cell_viewable_history = null;
            this.last_cell_history = null;
         }
    };

	CodeCell.prototype.create_df_info = function() {
	    var that = this;
        var info = $('<div></div>').addClass("cellinfo");
        var downstream_h = $('<h5>Downstream Dependencies </h5>').addClass('downstream-deps');
        var downstream_button = $('<span/>').addClass("ui-button ui-icon ui-icon-triangle-1-e");
        downstream_h.prepend(downstream_button);
        var select_downstream = $('<a>Select All</a>');
        var update_downstream = $('<a>Update All</a>');
        downstream_h.append(select_downstream);
        downstream_h.append("&nbsp;");
        downstream_h.append(update_downstream);
        var downstream_list = $('<ul></ul>');
        info.append(downstream_h);
        info.append(downstream_list);
        update_downstream.click(function() {
            var cids = $('li a', downstream_list).map(function() { return $(this).attr('href').substring(1); }).get();
            that.notebook.execute_cells_by_id(cids);
            that.notebook.select_cells_by_id(cids);
        });
        select_downstream.click(function() {
            var cids = $('li a', downstream_list).map(function() { return $(this).attr('href').substring(1); }).get();
            that.notebook.select_cells_by_id(cids);
        });

        var upstream_h = $('<h5>Upstream Dependencies </h5>').addClass('upstream-deps');
        var upstream_button = $('<span/>').addClass("ui-button ui-icon ui-icon-triangle-1-e");
        upstream_h.prepend(upstream_button);
        var select_upstream = $('<a>Select All</a>');
        upstream_h.append(select_upstream);

        var upstream_list = $('<ul></ul>');
        info.append(upstream_h);
        info.append(upstream_list);

        select_upstream.click(function() {
            var cids = $('li a', upstream_list).map(function() { return $(this).attr('href').substring(1); }).get();
            that.notebook.select_cells_by_id(cids);
        });

        var history_h = $('<h5>Cell History </h5>').addClass('viewable-history');
        var history_button = $('<span/>').addClass("ui-button ui-icon ui-icon-triangle-1-e");
        history_h.prepend(history_button);
        var history_list = $('<ul></ul>');
        info.append(history_h);
        info.append(history_list);


        info.children('h5').click(function() {
            $(this).children('.ui-icon').toggleClass("ui-icon-triangle-1-e ui-icon-triangle-1-s");
            $(this).next().toggle();
            return false;
        }).next().hide();

        $('.upstream-deps', info).hide();
        $('.downstream-deps', info).hide();

        this.cell_info_area = info;
        this.cell_viewable_history = history_list;
        this.cell_upstream_deps = upstream_list;
        this.cell_downstream_deps = downstream_list;

        this.element.append(info);
    };

    (function(_super) {
        CodeCell.prototype.create_element = function() {
            // we know this is called by the constructor right
            // so we will do the init_dfnb code here
            // (cannot patch the CodeCell constructor...I think)
            if (!("uuid" in this)) {
                this.init_dfnb();
            }

            var _super_result = _super.apply(this, arguments);

            var that = this;
            this.code_mirror.on('change', function() {
                that.was_changed = true;
            });

            this.create_df_info();

            this.element.attr('id', this.uuid);
            var aname = $('<a/>');
            aname.attr('name', this.uuid);
            this.element.append(aname);

            return _super_result;
        }
    }(CodeCell.prototype.create_element));

    CodeCell.prototype.execute = function (stop_on_error) {
        if (!this.kernel) {
            console.log("Can't execute cell since kernel is not set.");
            return;
        }

        if (stop_on_error === undefined) {
            stop_on_error = true;
        }

        // this.output_area.clear_output(false, true);
        this.clear_output_imm(false, true);
        var old_msg_id = this.last_msg_id;
        if (old_msg_id) {
            this.kernel.clear_callbacks_for_msg(old_msg_id);
            delete CodeCell.msg_cells[old_msg_id];
            this.last_msg_id = null;
        }
        if (this.get_text().trim().length === 0) {
            // nothing to do
            this.set_input_prompt(null);
            return;
        }
        this.set_input_prompt('*');
        this.element.addClass("running");

        if (! ("last_executed_i" in this.notebook.session)) {
            this.notebook.session.last_executed_iii = null;
            this.notebook.session.last_executed_ii = null;
            this.notebook.session.last_executed_i = null;
        }


        var callbacks = this.get_callbacks();

        this.last_msg_id = this.kernel.execute(this.get_text(), callbacks, {silent: false, store_history: true,
            stop_on_error : stop_on_error, user_expressions: {'__uuid__': this.uuid,
                '__code_dict__': this.notebook.get_code_dict()} });
        CodeCell.msg_cells[this.last_msg_id] = this;
        this.render();
        this.events.trigger('execute.CodeCell', {cell: this});
        var that = this;
        function handleFinished(evt, data) {
            if (that.kernel.id === data.kernel.id && that.last_msg_id === data.msg_id) {
            		that.events.trigger('finished_execute.CodeCell', {cell: that});
                that.events.off('finished_iopub.Kernel', handleFinished);
                var errflag = true;
                (that.output_area.outputs).forEach(function(out){ console.log(out); if(out.output_type == "error") {errflag = false}});
                console.log(errflag)
                if(errflag)
                {
                    that.notebook.session.last_executed_iii = that.notebook.session.last_executed_ii;
                    that.notebook.session.last_executed_ii = that.notebook.session.last_executed_i;
                    that.notebook.session.last_executed_i = that.uuid;
                }
      	    }
        }
        this.events.on('finished_iopub.Kernel', handleFinished);
    };

    (function(_super) {
        CodeCell.prototype.get_callbacks = function() {
            var callbacks = _super.apply(this, arguments);
            var that = this;
            callbacks["iopub"]["output"] = function() {
                that.events.trigger('set_dirty.Notebook', {value: true});
                var cell = null;
                if (arguments[0].content.execution_count !== undefined) {
                    cell = that.notebook.get_code_cell(arguments[0].content.execution_count);
                }
                if (!cell) {
                    cell = that;
                }
                cell.output_area.handle_output.apply(cell.output_area, arguments);
            };

            callbacks["iopub"]["execute_input"] = function() {
                var cid = arguments[0].content.execution_count;
                var cell = that.notebook.get_code_cell(cid);
                if (cell) {
                    cell.clear_output_imm(false, true);
                    cell.set_input_prompt('*');
                    cell.element.addClass("running");
                    cell.render();
                    that.events.trigger('execute.CodeCell', {cell: cell});
                }
            }

            return callbacks;
        }
    }(CodeCell.prototype.get_callbacks));

    (function(_super) {
        CodeCell.prototype._handle_execute_reply = function(msg) {
            var cell = this.notebook.get_code_cell(msg.content.execution_count);
            if (!cell) {
                cell = this;
            }
            if (cell == this && msg.metadata.status != "error") {
                var that = this;
                msg.content.upstream_deps.forEach(function (cid) {
                    var new_item = $('<li></li>');
                    var new_ahref = $('<a></a>');
                    new_ahref.attr('href', '#' + cid);
                    new_ahref.text("Cell[" + cid + "]");
                    new_ahref.click(function () {
                        that.notebook.select_by_id(cid);
                        that.notebook.scroll_to_cell_id(cid);
                        return false;
                    })
                    new_item.append(new_ahref);
                    that.cell_upstream_deps.append(new_item);
                    $('.upstream-deps', that.cell_info_area).show();
                });
                msg.content.downstream_deps.forEach(function (cid) {
                    var new_item = $('<li></li>');
                    var new_ahref = $('<a></a>');
                    new_ahref.attr('href', '#' + cid);
                    new_ahref.text("Cell[" + cid + "]");
                    new_ahref.click(function () {
                        that.notebook.select_by_id(cid);
                        that.notebook.scroll_to_cell_id(cid);
                        return false;
                    })
                    new_item.append(new_ahref);
                    that.cell_downstream_deps.append(new_item);
                    $('.downstream-deps', that.cell_info_area).show();
                });

                //Credit to https://stackoverflow.com/questions/14733374/how-to-generate-md5-file-hash-on-javascript
                var MD5 = function(s){function L(k,d){return(k<<d)|(k>>>(32-d))}function K(G,k){var I,d,F,H,x;F=(G&2147483648);H=(k&2147483648);I=(G&1073741824);d=(k&1073741824);x=(G&1073741823)+(k&1073741823);if(I&d){return(x^2147483648^F^H)}if(I|d){if(x&1073741824){return(x^3221225472^F^H)}else{return(x^1073741824^F^H)}}else{return(x^F^H)}}function r(d,F,k){return(d&F)|((~d)&k)}function q(d,F,k){return(d&k)|(F&(~k))}function p(d,F,k){return(d^F^k)}function n(d,F,k){return(F^(d|(~k)))}function u(G,F,aa,Z,k,H,I){G=K(G,K(K(r(F,aa,Z),k),I));return K(L(G,H),F)}function f(G,F,aa,Z,k,H,I){G=K(G,K(K(q(F,aa,Z),k),I));return K(L(G,H),F)}function D(G,F,aa,Z,k,H,I){G=K(G,K(K(p(F,aa,Z),k),I));return K(L(G,H),F)}function t(G,F,aa,Z,k,H,I){G=K(G,K(K(n(F,aa,Z),k),I));return K(L(G,H),F)}function e(G){var Z;var F=G.length;var x=F+8;var k=(x-(x%64))/64;var I=(k+1)*16;var aa=Array(I-1);var d=0;var H=0;while(H<F){Z=(H-(H%4))/4;d=(H%4)*8;aa[Z]=(aa[Z]| (G.charCodeAt(H)<<d));H++}Z=(H-(H%4))/4;d=(H%4)*8;aa[Z]=aa[Z]|(128<<d);aa[I-2]=F<<3;aa[I-1]=F>>>29;return aa}function B(x){var k="",F="",G,d;for(d=0;d<=3;d++){G=(x>>>(d*8))&255;F="0"+G.toString(16);k=k+F.substr(F.length-2,2)}return k}function J(k){k=k.replace(/rn/g,"n");var d="";for(var F=0;F<k.length;F++){var x=k.charCodeAt(F);if(x<128){d+=String.fromCharCode(x)}else{if((x>127)&&(x<2048)){d+=String.fromCharCode((x>>6)|192);d+=String.fromCharCode((x&63)|128)}else{d+=String.fromCharCode((x>>12)|224);d+=String.fromCharCode(((x>>6)&63)|128);d+=String.fromCharCode((x&63)|128)}}}return d}var C=Array();var P,h,E,v,g,Y,X,W,V;var S=7,Q=12,N=17,M=22;var A=5,z=9,y=14,w=20;var o=4,m=11,l=16,j=23;var U=6,T=10,R=15,O=21;s=J(s);C=e(s);Y=1732584193;X=4023233417;W=2562383102;V=271733878;for(P=0;P<C.length;P+=16){h=Y;E=X;v=W;g=V;Y=u(Y,X,W,V,C[P+0],S,3614090360);V=u(V,Y,X,W,C[P+1],Q,3905402710);W=u(W,V,Y,X,C[P+2],N,606105819);X=u(X,W,V,Y,C[P+3],M,3250441966);Y=u(Y,X,W,V,C[P+4],S,4118548399);V=u(V,Y,X,W,C[P+5],Q,1200080426);W=u(W,V,Y,X,C[P+6],N,2821735955);X=u(X,W,V,Y,C[P+7],M,4249261313);Y=u(Y,X,W,V,C[P+8],S,1770035416);V=u(V,Y,X,W,C[P+9],Q,2336552879);W=u(W,V,Y,X,C[P+10],N,4294925233);X=u(X,W,V,Y,C[P+11],M,2304563134);Y=u(Y,X,W,V,C[P+12],S,1804603682);V=u(V,Y,X,W,C[P+13],Q,4254626195);W=u(W,V,Y,X,C[P+14],N,2792965006);X=u(X,W,V,Y,C[P+15],M,1236535329);Y=f(Y,X,W,V,C[P+1],A,4129170786);V=f(V,Y,X,W,C[P+6],z,3225465664);W=f(W,V,Y,X,C[P+11],y,643717713);X=f(X,W,V,Y,C[P+0],w,3921069994);Y=f(Y,X,W,V,C[P+5],A,3593408605);V=f(V,Y,X,W,C[P+10],z,38016083);W=f(W,V,Y,X,C[P+15],y,3634488961);X=f(X,W,V,Y,C[P+4],w,3889429448);Y=f(Y,X,W,V,C[P+9],A,568446438);V=f(V,Y,X,W,C[P+14],z,3275163606);W=f(W,V,Y,X,C[P+3],y,4107603335);X=f(X,W,V,Y,C[P+8],w,1163531501);Y=f(Y,X,W,V,C[P+13],A,2850285829);V=f(V,Y,X,W,C[P+2],z,4243563512);W=f(W,V,Y,X,C[P+7],y,1735328473);X=f(X,W,V,Y,C[P+12],w,2368359562);Y=D(Y,X,W,V,C[P+5],o,4294588738);V=D(V,Y,X,W,C[P+8],m,2272392833);W=D(W,V,Y,X,C[P+11],l,1839030562);X=D(X,W,V,Y,C[P+14],j,4259657740);Y=D(Y,X,W,V,C[P+1],o,2763975236);V=D(V,Y,X,W,C[P+4],m,1272893353);W=D(W,V,Y,X,C[P+7],l,4139469664);X=D(X,W,V,Y,C[P+10],j,3200236656);Y=D(Y,X,W,V,C[P+13],o,681279174);V=D(V,Y,X,W,C[P+0],m,3936430074);W=D(W,V,Y,X,C[P+3],l,3572445317);X=D(X,W,V,Y,C[P+6],j,76029189);Y=D(Y,X,W,V,C[P+9],o,3654602809);V=D(V,Y,X,W,C[P+12],m,3873151461);W=D(W,V,Y,X,C[P+15],l,530742520);X=D(X,W,V,Y,C[P+2],j,3299628645);Y=t(Y,X,W,V,C[P+0],U,4096336452);V=t(V,Y,X,W,C[P+7],T,1126891415);W=t(W,V,Y,X,C[P+14],R,2878612391);X=t(X,W,V,Y,C[P+5],O,4237533241);Y=t(Y,X,W,V,C[P+12],U,1700485571);V=t(V,Y,X,W,C[P+3],T,2399980690);W=t(W,V,Y,X,C[P+10],R,4293915773);X=t(X,W,V,Y,C[P+1],O,2240044497);Y=t(Y,X,W,V,C[P+8],U,1873313359);V=t(V,Y,X,W,C[P+15],T,4264355552);W=t(W,V,Y,X,C[P+6],R,2734768916);X=t(X,W,V,Y,C[P+13],O,1309151649);Y=t(Y,X,W,V,C[P+4],U,4149444226);V=t(V,Y,X,W,C[P+11],T,3174756917);W=t(W,V,Y,X,C[P+2],R,718787259);X=t(X,W,V,Y,C[P+9],O,3951481745);Y=K(Y,h);X=K(X,E);W=K(W,v);V=K(V,g)}var i=B(Y)+B(X)+B(W)+B(V);return i.toLowerCase()};
                var cellmd5 = MD5(that.get_text());
                var now = new Date();
                var now_utc = now.getUTCFullYear() + "/" + ("0" + (now.getUTCMonth()+1)).slice(-2) + "/" +
                ("0" + now.getUTCDate()).slice(-2) + " " +
                ("0" + now.getUTCHours()).slice(-2) + ":" +
                ("0" + now.getUTCMinutes()).slice(-2) + ":" +
                ("0" + now.getUTCSeconds()).slice(-2) +
                (" UTC Time");
                globalhistory.push({uuid:that.uuid,oldmd5:that.last_cell_history,newmd5:cellmd5,date:now_utc});
                //var input = document.getElementById('range');
                if(globalhistory.length == 3){
                    $('.range').append('<br/><p class="range"></p>');
                    $('.range').show();
                    $('#range').show();
                }
                old_range_val = globalhistory.length - 1;
                $('#range').slider("option","max",globalhistory.length);// = 0;
                $('#range').slider("option","value",globalhistory.length);
                //input.max = globalhistory.length;
                //input.value = globalhistory.length;
                $('.range p').text(now_utc);
                if(!(cellmd5 in that.cell_history)) {
                    that.cell_history[cellmd5] = {source:that.get_text(),parent:that.last_cell_history};
                }
                that.last_cell_history = cellmd5;
                this.add_to_hist_list(that.uuid,cellmd5,now_utc, that.notebook.session.kernel.username, that.notebook.session.id);
            }
            _super.apply(cell, arguments);
        }
    }(CodeCell.prototype._handle_execute_reply));

    CodeCell.prototype.add_to_hist_list = function(uuid, cellmd5,now_utc, username, sess_id)
    {
                var that = this;
                var new_item = $('<li></li>');
                var new_ahref = $('<a></a>');
                new_ahref.attr('href', '#' + uuid);
                new_ahref.attr('md5',cellmd5);
                new_ahref.attr('utc',now_utc);
                new_ahref.attr('user',username);
                new_ahref.attr('sess',sess_id);
                new_ahref.text("Hash #" + cellmd5.substring(0,6) + "    Date: " + now_utc + "    User: " + username + "   Session ID: " + sess_id);
                new_ahref.click(function () {
                           var active_md5 = this.getAttribute('md5');
                           that.last_cell_history = active_md5;
                           console.log(that.last_cell_history);
                           that.notebook.get_code_cell(this.getAttribute('href').substring(1)).set_text(that.cell_history[active_md5].source);
                           return false;
                          })
                new_item.append(new_ahref);
                that.cell_viewable_history.append(new_item);
                $('.viewable-history', that.cell_info_area).show();
    };

    (function(_super) {
        CodeCell.prototype.set_input_prompt = function(number) {
            if (number != '*') {
                number = this.uuid;
            }
            return _super.call(this, number);
        };
    }(CodeCell.prototype.set_input_prompt));

    CodeCell.prototype.clear_df_info = function() {
        $('.upstream-deps', this.cell_info_area).hide();
        $('.downstream-deps', this.cell_info_area).hide();
        $('.ui-icon', this.cell_info_area).removeClass('ui-icon-triangle-1-s').addClass('ui-icon-triangle-1-e');
        $(this.cell_upstream_deps).empty();
        $(this.cell_upstream_deps).hide();
        $(this.cell_downstream_deps).empty();
        $(this.cell_downstream_deps).hide();
    };

    CodeCell.prototype.clear_output_imm = function(wait, ignore_queue) {
        // like clear_output, but without the event
        this.output_area.clear_output(wait, ignore_queue);
        this.clear_df_info();
    };

    (function(_super) {
        CodeCell.prototype.clear_output = function(wait) {
            _super.apply(this, arguments);
            this.clear_df_info();
        };
    }(CodeCell.prototype.clear_output));

    (function(_super) {
        CodeCell.prototype.fromJSON = function(data) {
            var uuid = dfutils.pad_str_left(data.execution_count.toString(16),
                this.notebook.get_default_id_length());
            data.outputs.forEach(function(out) {
                if (out.output_type === "execute_result") {
                    out.execution_count = uuid;
                }
            });

            _super.call(this, data);

            this.uuid = uuid;
            this.element.attr('id', this.uuid);
            var aname = $('<a/>');
            aname.attr('name', this.uuid);
            this.element.append(aname);
            this.set_input_prompt();
            this.was_changed = true;

            var that = this;
            if(typeof(data.metadata.cell_history) != 'undefined'){
                        this.cell_history = data.metadata.cell_history;
                        this.last_cell_history = data.metadata.last_cell_history;
                        data.metadata.cell_viewable_history.forEach(function(a){
	                    that.add_to_hist_list(that.uuid,a.md5,a.utc, a.user, a.sess);});
            };

        }
    }(CodeCell.prototype.fromJSON));

    (function(_super) {
        CodeCell.prototype.toJSON = function() {
            data = _super.apply(this, arguments);
            // FIXME check that this won't exceed the size of int
            data.execution_count = parseInt(this.uuid,16);

            var that = this;
            var view_list = [];
            $(that.cell_viewable_history).find('a').each(function() {
                view_list.push({md5:this.getAttribute('md5'),utc:this.getAttribute('utc'),user:this.getAttribute('user'),sess:this.getAttribute('sess')});
            });
            data.metadata.last_cell_history = that.last_cell_history;
            data.metadata.cell_history = that.cell_history;
            data.metadata.cell_viewable_history = view_list;

            data.outputs.forEach(function(out) {
                if (out.output_type === "execute_result") {
                    out.execution_count = data.execution_count;
                }
            });
            return data;
        }
    }(CodeCell.prototype.toJSON));
    return {
       create_scrollbar: create_scrollbar,
        global_history: globalhistory
   }
});